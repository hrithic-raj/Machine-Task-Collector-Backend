const express = require('express');
const router = express.Router();
const MachineTask = require('../models/MachineTask');
const Company = require('../models/Company');
const Tag = require('../models/Tag');
const { protect } = require('../middleware/auth');
const { uploadMultiple, uploadErrorHandler } = require('../middleware/upload');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const axios = require('axios');
const os = require('os');

// GET /api/tasks - Get all tasks with search, filter, and pagination
router.get('/', protect, async (req, res) => {
  try {
    const { search, techStack, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let query = {};

    // Search across company name, task title, and task body
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { body: { $regex: search, $options: 'i' } },
      ];

      // Also search in company name - we'll need to populate and filter
      // We'll handle this differently by getting company IDs first
    }

    // Filter by techStack
    if (techStack) {
      const stacks = Array.isArray(techStack) ? techStack : [techStack];
      query.techStack = { $in: stacks };
    }

    // Get tasks with pagination
    let tasksQuery = MachineTask.find(query)
      .populate('company', 'name place contactEmail contactPhone')
      .populate('tags', 'name')
      .populate('submittedBy', 'name email')
      .sort({ createdAt: -1 });

    // If searching by company name, we need to get matching company IDs first
    if (search) {
      const companyMatches = await Company.find({
        name: { $regex: search, $options: 'i' },
      }).select('_id');

      if (companyMatches.length > 0) {
        const companyIds = companyMatches.map((c) => c._id);
        // Add OR condition for company name
        tasksQuery = MachineTask.find({
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { body: { $regex: search, $options: 'i' } },
            { company: { $in: companyIds } },
          ],
        })
          .populate('company', 'name place contactEmail contactPhone')
          .populate('tags', 'name')
          .populate('submittedBy', 'name email')
          .sort({ createdAt: -1 });
      }
    }

    const total = await MachineTask.countDocuments(query);
    const tasks = await tasksQuery.skip(skip).limit(parseInt(limit));

    res.json({
      success: true,
      count: tasks.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: tasks,
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching tasks',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/tasks/:id - Get single task
router.get('/:id', protect, async (req, res) => {
  try {
    const task = await MachineTask.findById(req.params.id)
      .populate('company', 'name place contactEmail contactPhone')
      .populate('tags', 'name')
      .populate('submittedBy', 'name email');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching task',
    });
  }
});

// GET /api/tasks/:id/download - Download task as ZIP with markdown and attachments
router.get('/:id/download', protect, async (req, res) => {
  const taskId = req.params.id;
  let tempDir;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (tempDir) {
      try {
        await fs.remove(tempDir);
      } catch (e) {
        console.error('Failed to cleanup temp dir:', e.message);
      }
    }
  };

  try {
    // Fetch task with all populated data
    const task = await MachineTask.findById(taskId)
      .populate('company', 'name place contactEmail contactPhone')
      .populate('tags', 'name')
      .populate('submittedBy', 'name email');

    if (!task) {
      await cleanup();
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Create a temporary directory for this download (use OS temp dir for compatibility)
    tempDir = path.join(os.tmpdir(), `task-${taskId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
    await fs.ensureDir(tempDir);

    // Determine format from environment variable
    const format = DOWNLOAD_FORMAT.toLowerCase() === 'html' ? 'html' : 'md';
    const fileExtension = format === 'html' ? 'html' : 'md';
    const fileName = format === 'html' ? 'TASK_DETAILS.html' : 'TASK_DETAILS.md';

    // Generate content based on format
    const fileContent = format === 'html' ? generateTaskHTML(task) : generateTaskMarkdown(task);
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, fileContent, 'utf-8');

    // Set response headers for ZIP download
    const zipFilename = `task-${task.title.replace(/[^a-z0-9]/gi, '_')}-${taskId}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    // Create ZIP archive and pipe to response
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error creating archive',
        });
      } else {
        res.end();
      }
    });

    // Cleanup when archive finishes or response closes
    archive.on('end', cleanup);
    res.on('close', cleanup);

    // Pipe archive to response
    archive.pipe(res);

    // Append documentation file (markdown or HTML)
    archive.file(filePath, { name: fileName });

    // Append attachment files if any
    if (task.files && task.files.length > 0) {
      const filesDir = path.join(tempDir, 'attachments');
      await fs.ensureDir(filesDir);

      for (const file of task.files) {
        const fileUrl = file.url || file.path;
        const fileName = file.originalName || `file-${file._id}`;
        const fileDestPath = path.join(filesDir, fileName);

        try {
          // Download file from URL (Cloudinary or local)
          if (fileUrl && fileUrl.startsWith('http')) {
            const response = await axios.get(fileUrl, {
              responseType: 'stream',
            });
            const writer = fs.createWriteStream(fileDestPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });
          } else if (file.path) {
            // Local file (legacy) - copy if exists
            const localPath = path.join(__dirname, '..', '..', file.path);
            if (await fs.pathExists(localPath)) {
              await fs.copy(localPath, fileDestPath);
            }
          }

          // Add file to archive with relative path
          archive.file(fileDestPath, {
            name: path.join('attachments', fileName),
          });
        } catch (fileError) {
          console.error(`Failed to download file ${fileName}:`, fileError.message);
          // Continue with other files - don't fail entire archive
        }
      }
    }

    // Finalize archive
    await archive.finalize();
  } catch (error) {
    console.error('Download error:', error);
    await cleanup();

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Server error while generating download',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
});

// Get download format from environment (default: 'md')
const DOWNLOAD_FORMAT = process.env.DOWNLOAD_FORMAT || 'md';

// Helper function to generate markdown content
function generateTaskMarkdown(task) {
  const techStackList = task.techStack ? task.techStack.join(', ') : 'None';
  const tagsList = task.tags ? task.tags.map((t) => `#${t.name}`).join(' ') : 'None';

  return `# ${task.title}

## Overview

**Company:** ${task.company?.name || 'Unknown Company'}
${task.company?.place ? `**Location:** ${task.company.place}` : ''}
${task.company?.contactEmail ? `**Contact Email:** ${task.company.contactEmail}` : ''}
${task.company?.contactPhone ? `**Contact Phone:** ${task.company.contactPhone}` : ''}

**Tech Stack:** ${techStackList}

**Tags:** ${tagsList}

**Submitted By:** ${task.submittedBy?.name || 'Unknown'}
${task.submittedBy?.email ? `**Email:** ${task.submittedBy.email}` : ''}

**Created:** ${new Date(task.createdAt).toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})}

## Description

${task.body}

---

## Attachments

${task.files && task.files.length > 0 ? `This task contains ${task.files.length} attachment(s) in the \`attachments/\` folder.` : 'No attachments.'}

*Generated on ${new Date().toLocaleString()} from Machine Task Collector*
`;
}

// Helper function to generate HTML content
function generateTaskHTML(task) {
  const techStackList = task.techStack
    ? task.techStack
        .map((stack) => `<span class="tech-badge">${escapeHtml(stack)}</span>`)
        .join('')
    : '<span class="tech-badge">None</span>';
  const tagsList = task.tags
    ? task.tags.map((t) => `<span class="tag">#${escapeHtml(t.name)}</span>`).join(' ')
    : '<span class="tag">None</span>';

  const escapeHtml = (str) => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(task.title)} - Machine Task</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f9f9f9;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 {
      color: #1a1a1a;
      font-size: 2em;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #e0e0e0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
      padding: 20px;
      background: #f5f5f5;
      border-radius: 6px;
    }
    .meta-item {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-weight: 600;
      color: #666;
      font-size: 0.875em;
      margin-bottom: 4px;
    }
    .meta-value {
      color: #1a1a1a;
      word-break: break-word;
    }
    .tech-stack, .tags {
      margin: 24px 0;
    }
    .section-label {
      font-weight: 600;
      color: #444;
      margin-bottom: 12px;
      font-size: 1.1em;
    }
    .tech-badge {
      display: inline-block;
      background: #2563eb;
      color: white;
      padding: 6px 14px;
      border-radius: 20px;
      margin: 4px 4px 4px 0;
      font-size: 0.875em;
      font-weight: 500;
    }
    .tag {
      display: inline-block;
      background: #e5e7eb;
      color: #374151;
      padding: 6px 14px;
      border-radius: 20px;
      margin: 4px 4px 4px 0;
      font-size: 0.875em;
    }
    .description {
      margin: 32px 0;
    }
    .description-label {
      font-weight: 600;
      color: #444;
      margin-bottom: 12px;
      font-size: 1.1em;
    }
    .description-content {
      background: #f9f9f9;
      padding: 24px;
      border-radius: 6px;
      border-left: 4px solid #2563eb;
    }
    .attachments {
      margin: 32px 0;
      padding: 20px;
      background: #f0f9ff;
      border-radius: 6px;
      border: 1px dashed #3b82f6;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      color: #888;
      font-size: 0.875em;
      text-align: center;
    }
    .company-info {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .company-info span {
      margin-right: 8px;
    }
    .company-info span:not(:last-child)::after {
      content: "•";
      margin-left: 8px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(task.title)}</h1>

    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Company</span>
        <span class="meta-value">${escapeHtml(task.company?.name || 'Unknown Company')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Location</span>
        <span class="meta-value">${escapeHtml(task.company?.place || 'Not specified')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Contact Email</span>
        <span class="meta-value">${escapeHtml(task.company?.contactEmail || 'Not specified')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Contact Phone</span>
        <span class="meta-value">${escapeHtml(task.company?.contactPhone || 'Not specified')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Tech Stack</span>
        <span class="meta-value">${techStackList}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Tags</span>
        <span class="meta-value">${tagsList}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Submitted By</span>
        <span class="meta-value">${escapeHtml(task.submittedBy?.name || 'Unknown')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Email</span>
        <span class="meta-value">${escapeHtml(task.submittedBy?.email || 'Not specified')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Created</span>
        <span class="meta-value">${new Date(task.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}</span>
      </div>
    </div>

    <div class="description">
      <div class="description-label">Description</div>
      <div class="description-content">${task.body}</div>
    </div>

    <div class="attachments">
      <div class="section-label">
        Attachments ${task.files && task.files.length > 0 ? `(${task.files.length})` : ''}
      </div>
      ${task.files && task.files.length > 0
        ? '<p>The attachments are included in the <code>attachments/</code> folder of this ZIP archive.</p>'
        : '<p>No attachments.</p>'
      }
    </div>

    <div class="footer">
      Generated on ${new Date().toLocaleString()} from Machine Task Collector
    </div>
  </div>
</body>
</html>
`;
}

// POST /api/tasks - Create new task (with file uploads)
router.post('/', protect, uploadMultiple, uploadErrorHandler, async (req, res) => {
  try {
    console.log('=== Task Creation Start ===');
    console.log('User:', req.user._id);
    console.log('Body fields:', {
      title: req.body.title,
      body: req.body.body ? 'present' : 'missing',
      techStack: req.body.techStack,
      companyId: req.body.companyId,
      newCompanyName: req.body.newCompanyName,
      tagIds: req.body.tagIds,
      newTagNames: req.body.newTagNames,
    });
    console.log('Files uploaded (multer):', req.files?.length || 0);

    const {
      title,
      body,
      techStack,
      companyId,
      newCompanyName,
      newCompanyPlace,
      newCompanyEmail,
      newCompanyPhone,
      tagIds,
      newTagNames,
    } = req.body;

    // Validate required fields
    if (!title || !body) {
      console.error('Validation failed: title or body missing');
      return res.status(400).json({
        success: false,
        message: 'Title and body are required',
      });
    }

    // Handle company - either use existing or create new
    let company;
    if (newCompanyName) {
      console.log('Creating new company:', newCompanyName);
      // Create new company
      company = await Company.create({
        name: newCompanyName.trim(),
        place: newCompanyPlace || '',
        contactEmail: newCompanyEmail || '',
        contactPhone: newCompanyPhone || '',
        createdBy: req.user._id,
      });
      console.log('Company created:', company._id);
    } else if (companyId) {
      console.log('Using existing company:', companyId);
      // Use existing company
      company = await Company.findById(companyId);
      if (!company) {
        console.error('Company not found:', companyId);
        return res.status(400).json({
          success: false,
          message: 'Selected company not found',
        });
      }
      console.log('Company found:', company._id);
    } else {
      console.error('No company specified');
      return res.status(400).json({
        success: false,
        message: 'Please select or create a company',
      });
    }

    // Handle tags - get existing tags or create new ones
    let tags = [];
    console.log('Processing tags - tagIds:', tagIds, 'newTagNames:', newTagNames);
    if (tagIds) {
      const tagIdArray = typeof tagIds === 'string' ? [tagIds] : tagIds;
      console.log('Fetching existing tags:', tagIdArray);
      const existingTags = await Tag.find({
        _id: { $in: tagIdArray },
      });
      tags = existingTags.map((t) => t._id);
      console.log('Found existing tags:', tags);
    }

    if (newTagNames) {
      const namesToCreate = typeof newTagNames === 'string' ? [newTagNames] : newTagNames;
      console.log('Creating new tags:', namesToCreate);
      for (const name of namesToCreate) {
        if (!name.trim()) continue;

        // Check if tag exists (case-insensitive)
        let tag = await Tag.findOne({ name: name.trim().toLowerCase() });
        if (!tag) {
          tag = await Tag.create({
            name: name.trim().toLowerCase(),
            createdBy: req.user._id,
          });
          console.log('Created new tag:', tag._id, tag.name);
        } else {
          console.log('Tag already exists:', tag._id, tag.name);
        }
        tags.push(tag._id);
      }
    }
    console.log('Final tag IDs to assign to task:', tags);

    // Upload files to Cloudinary and prepare metadata
    let files = [];
    if (req.files && req.files.length > 0) {
      console.log(`Uploading ${req.files.length} files to Cloudinary...`);
      try {
        const uploadPromises = req.files.map(async (file, index) => {
          // Determine resource_type: use 'raw' for PDFs, 'auto' for others
          const isPdf = file.mimetype === 'application/pdf';
          const resource_type = isPdf ? 'raw' : 'auto';

          console.log(`File ${index + 1}: ${file.originalname} (${file.mimetype})`);
          console.log(`  -> Uploading to folder 'MachineTasks' as ${resource_type}`);

          try {
            const result = await uploadToCloudinary(file.path, {
              folder: 'MachineTasks',
              resource_type,
            });
            console.log(`  Uploaded! Public ID: ${result.public_id}`);
            console.log(`  Folder in response: ${result.folder || 'root'}`);
            console.log(`  URL: ${result.secure_url}`);

            return {
              url: result.secure_url,
              public_id: result.public_id,
              originalName: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
            };
          } finally {
            // Clean up local temp file after upload attempt (success or failure)
            try {
              if (require('fs').existsSync(file.path)) {
                require('fs').unlinkSync(file.path);
                console.log(`  Cleaned up temp file: ${file.path}`);
              }
            } catch (e) {
              console.error('Failed to cleanup temp file:', file.path);
            }
          }
        });
        files = await Promise.all(uploadPromises);
        console.log('All files uploaded to Cloudinary successfully. Files array:', files.length);
      } catch (error) {
        console.error('Cloudinary upload error:', error);
        // Delete task and related files if already created? We're before task creation
        return res.status(500).json({
          success: false,
          message: 'Failed to upload files to cloud storage',
          error:
            process.env.NODE_ENV === 'development'
              ? error.message
              : 'Check Cloudinary configuration and credentials',
        });
      }
    } else {
      console.log('No files to upload');
    }

    // Parse techStack (expecting array or comma-separated string)
    let techStackArray = [];
    if (techStack) {
      if (Array.isArray(techStack)) {
        techStackArray = techStack;
      } else if (typeof techStack === 'string') {
        techStackArray = techStack.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }

    // Create task
    console.log('Creating task with data:', {
      title: title.trim(),
      techStack: techStackArray,
      company: company._id,
      tags: tags,
      filesCount: files.length,
      submittedBy: req.user._id,
    });
    const task = await MachineTask.create({
      title: title.trim(),
      body,
      techStack: techStackArray,
      company: company._id,
      tags: tags,
      files,
      submittedBy: req.user._id,
    });
    console.log('Task created successfully:', task._id);

    // Populate response
    await task.populate('company', 'name place contactEmail contactPhone');
    await task.populate('tags', 'name');
    await task.populate('submittedBy', 'name email');

    console.log('Task populated, sending response');
    res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: task,
    });
  } catch (error) {
    console.error('Create task error:', error);

    // Clean up uploaded files if task creation fails
    if (req.files) {
      req.files.forEach((file) => {
        try {
          if (require('fs').existsSync(file.path)) {
            require('fs').unlinkSync(file.path);
          }
        } catch (e) {
          console.error('Failed to cleanup uploaded file:', file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while creating task',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', protect, uploadMultiple, uploadErrorHandler, async (req, res) => {
  try {
    const task = await MachineTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user is the owner
    if (task.submittedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this task',
      });
    }

    const {
      title,
      body,
      techStack,
      companyId,
      newCompanyName,
      newCompanyPlace,
      newCompanyEmail,
      newCompanyPhone,
      tagIds,
      newTagNames,
    } = req.body;

    // Handle company if changed
    let company = task.company;
    if (newCompanyName || companyId) {
      if (newCompanyName) {
        company = await Company.create({
          name: newCompanyName.trim(),
          place: newCompanyPlace || '',
          contactEmail: newCompanyEmail || '',
          contactPhone: newCompanyPhone || '',
          createdBy: req.user._id,
        });
      } else if (companyId && companyId !== task.company.toString()) {
        company = await Company.findById(companyId);
        if (!company) {
          return res.status(400).json({
            success: false,
            message: 'Selected company not found',
          });
        }
      }
    }

    // Handle tags if changed
    let tags = task.tags;
    if (tagIds || newTagNames) {
      tags = [];
      if (tagIds) {
        const existingTags = await Tag.find({
          _id: { $in: typeof tagIds === 'string' ? [tagIds] : tagIds },
        });
        tags = existingTags.map((t) => t._id);
      }

      if (newTagNames) {
        const namesToCreate = typeof newTagNames === 'string' ? [newTagNames] : newTagNames;
        for (const name of namesToCreate) {
          if (!name.trim()) continue;
          let tag = await Tag.findOne({ name: name.trim().toLowerCase() });
          if (!tag) {
            tag = await Tag.create({
              name: name.trim().toLowerCase(),
              createdBy: req.user._id,
            });
          }
          tags.push(tag._id);
        }
      }
    }

    // Parse techStack
    let techStackArray = task.techStack;
    if (techStack) {
      techStackArray = Array.isArray(techStack)
        ? techStack
        : techStack.split(',').map((t) => t.trim()).filter(Boolean);
    }

    // Update task fields
    task.title = title ? title.trim() : task.title;
    task.body = body || task.body;
    task.techStack = techStackArray;
    task.company = company._id;
    task.tags = tags;

    // Handle file deletions (if any files marked for removal)
    if (req.body.filesToDelete) {
      const filesToDeleteIds = Array.isArray(req.body.filesToDelete)
        ? req.body.filesToDelete
        : [req.body.filesToDelete];

      console.log(`Deleting ${filesToDeleteIds.length} files:`, filesToDeleteIds);

      for (const fileId of filesToDeleteIds) {
        try {
          const fileToRemove = task.files.find((f) => f._id.toString() === fileId);
          if (fileToRemove) {
            // Delete from Cloudinary if has public_id
            if (fileToRemove.public_id) {
              await deleteFromCloudinary(fileToRemove.public_id);
              console.log(`Deleted from Cloudinary: ${fileToRemove.public_id}`);
            } else if (fileToRemove.path) {
              // Delete local file (legacy)
              if (require('fs').existsSync(fileToRemove.path)) {
                require('fs').unlinkSync(fileToRemove.path);
                console.log(`Deleted local file: ${fileToRemove.path}`);
              }
            }
            // Remove from task.files array
            task.files = task.files.filter((f) => f._id.toString() !== fileId);
          }
        } catch (err) {
          console.error(`Failed to delete file ${fileId}:`, err);
          // Continue with other deletions
        }
      }
    }

    // Add new files if uploaded - upload to Cloudinary first
    if (req.files && req.files.length > 0) {
      try {
        const uploadPromises = req.files.map(async (file) => {
          const isPdf = file.mimetype === 'application/pdf';
          const resource_type = isPdf ? 'raw' : 'auto';

          try {
            const result = await uploadToCloudinary(file.path, {
              folder: 'MachineTasks',
              resource_type,
            });

            console.log("UPLOAD RESULT:", result);
            return {
              url: result.secure_url,
              public_id: result.public_id,
              originalName: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
            };
          } finally {
            // Clean up local temp file
            try {
              if (require('fs').existsSync(file.path)) {
                require('fs').unlinkSync(file.path);
              }
            } catch (e) {
              console.error('Failed to cleanup temp file:', file.path);
            }
          }
        });
        const newFiles = await Promise.all(uploadPromises);
        task.files = [...task.files, ...newFiles];
      } catch (error) {
        console.error('Cloudinary upload error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload files to cloud storage',
          error:
            process.env.NODE_ENV === 'development'
              ? error.message
              : 'Check Cloudinary configuration and credentials',
        });
      }
    }

    await task.save();
    await task.populate('company', 'name place contactEmail contactPhone');
    await task.populate('tags', 'name');
    await task.populate('submittedBy', 'name email');

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: task,
    });
  } catch (error) {
    console.error('Update task error:', error);

    // Clean up uploaded files if update fails
    if (req.files) {
      req.files.forEach((file) => {
        try {
          if (require('fs').existsSync(file.path)) {
            require('fs').unlinkSync(file.path);
          }
        } catch (e) {
          console.error('Failed to cleanup uploaded file:', file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while updating task',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', protect, async (req, res) => {
  try {
    const task = await MachineTask.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check if user is the owner or admin
    if (task.submittedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this task',
      });
    }

    // Delete associated files (from Cloudinary if they have public_id, otherwise local)
    if (task.files && task.files.length > 0) {
      for (const file of task.files) {
        try {
          if (file.public_id) {
            // Delete from Cloudinary
            await deleteFromCloudinary(file.public_id);
          } else if (file.path) {
            // Delete from local storage (legacy files)
            if (require('fs').existsSync(file.path)) {
              require('fs').unlinkSync(file.path);
            }
          }
        } catch (e) {
          console.error('Failed to delete file:', file.path || file.public_id);
        }
      }
    }

    await task.deleteOne();

    res.json({
      success: true,
      message: 'Task deleted successfully',
    });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting task',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
