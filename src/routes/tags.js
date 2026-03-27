const express = require('express');
const router = express.Router();
const Tag = require('../models/Tag');
const { protect } = require('../middleware/auth');

// GET /api/tags - Get all tags (with optional search)
router.get('/', protect, async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const tags = await Tag.find(query)
      .sort({ name: 1 })
      .limit(100); // Limit to prevent too many results

    res.json({
      success: true,
      count: tags.length,
      data: tags,
    });
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching tags',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// POST /api/tags - Create a new tag
router.post('/', protect, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Tag name is required',
      });
    }

    // Check if tag already exists (case-insensitive)
    const existingTag = await Tag.findOne({
      name: { $regex: `^${name}$`, $options: 'i' },
    });

    if (existingTag) {
      return res.status(400).json({
        success: false,
        message: 'Tag already exists',
        data: existingTag,
      });
    }

    const tag = await Tag.create({
      name: name.trim().toLowerCase(),
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Tag created successfully',
      data: tag,
    });
  } catch (error) {
    console.error('Create tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating tag',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/tags/:id - Get single tag
router.get('/:id', protect, async (req, res) => {
  try {
    const tag = await Tag.findById(req.params.id);

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: 'Tag not found',
      });
    }

    res.json({
      success: true,
      data: tag,
    });
  } catch (error) {
    console.error('Get tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching tag',
    });
  }
});

module.exports = router;
