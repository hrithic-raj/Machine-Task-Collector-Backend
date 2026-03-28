const express = require('express');
const router = express.Router();
const MachineTask = require('../models/MachineTask');
const Company = require('../models/Company');
const Tag = require('../models/Tag');
const { protect } = require('../middleware/auth');
const { uploadMultiple, uploadErrorHandler } = require('../middleware/upload');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

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
