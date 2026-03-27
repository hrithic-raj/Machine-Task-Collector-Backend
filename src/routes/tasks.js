const express = require('express');
const router = express.Router();
const MachineTask = require('../models/MachineTask');
const Company = require('../models/Company');
const Tag = require('../models/Tag');
const { protect } = require('../middleware/auth');
const { uploadMultiple, uploadErrorHandler } = require('../middleware/upload');

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
      return res.status(400).json({
        success: false,
        message: 'Title and body are required',
      });
    }

    // Handle company - either use existing or create new
    let company;
    if (newCompanyName) {
      // Create new company
      company = await Company.create({
        name: newCompanyName.trim(),
        place: newCompanyPlace || '',
        contactEmail: newCompanyEmail || '',
        contactPhone: newCompanyPhone || '',
        createdBy: req.user._id,
      });
    } else if (companyId) {
      // Use existing company
      company = await Company.findById(companyId);
      if (!company) {
        return res.status(400).json({
          success: false,
          message: 'Selected company not found',
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please select or create a company',
      });
    }

    // Handle tags - get existing tags or create new ones
    let tags = [];
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

        // Check if tag exists (case-insensitive)
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

    // Prepare file metadata from multer
    const files = req.files ? req.files.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      path: file.path,
      mimetype: file.mimetype,
      size: file.size,
    })) : [];

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
    const task = await MachineTask.create({
      title: title.trim(),
      body,
      techStack: techStackArray,
      company: company._id,
      tags: tags,
      files,
      submittedBy: req.user._id,
    });

    // Populate response
    await task.populate('company', 'name place contactEmail contactPhone');
    await task.populate('tags', 'name');
    await task.populate('submittedBy', 'name email');

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

    // Add new files if uploaded
    if (req.files && req.files.length > 0) {
      const newFiles = req.files.map((file) => ({
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size,
      }));
      task.files = [...task.files, ...newFiles];
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

    // Delete associated files
    if (task.files && task.files.length > 0) {
      task.files.forEach((file) => {
        try {
          if (require('fs').existsSync(file.path)) {
            require('fs').unlinkSync(file.path);
          }
        } catch (e) {
          console.error('Failed to delete file:', file.path);
        }
      });
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
