const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const { protect, authorize } = require('../middleware/auth');

// GET /api/companies - Get all companies (with optional search)
router.get('/', protect, async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const companies = await Company.find(query)
      .sort({ name: 1 })
      .limit(100); // Limit to prevent too many results

    res.json({
      success: true,
      count: companies.length,
      data: companies,
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching companies',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// POST /api/companies - Create a new company
router.post('/', protect, async (req, res) => {
  try {
    const { name, place, contactEmail, contactPhone } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required',
      });
    }

    // Check if company already exists (case-insensitive)
    const existingCompany = await Company.findOne({
      name: { $regex: `^${name}$`, $options: 'i' },
    });

    if (existingCompany) {
      return res.status(400).json({
        success: false,
        message: 'Company with this name already exists',
        data: existingCompany,
      });
    }

    const company = await Company.create({
      name: name.trim(),
      place: place || '',
      contactEmail: contactEmail || '',
      contactPhone: contactPhone || '',
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Company created successfully',
      data: company,
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating company',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/companies/:id - Get single company
router.get('/:id', protect, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    res.json({
      success: true,
      data: company,
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching company',
    });
  }
});

// PUT /api/companies/:id - Update a company
router.put('/:id', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, place, contactEmail, contactPhone } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required',
      });
    }

    // Find company
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    // Check if name is being changed and if it conflicts with another company
    if (name.trim() !== company.name) {
      const existingCompany = await Company.findOne({
        name: { $regex: `^${name.trim()}$`, $options: 'i' },
        _id: { $ne: company._id }, // Exclude current company
      });

      if (existingCompany) {
        return res.status(400).json({
          success: false,
          message: 'Company with this name already exists',
          data: existingCompany,
        });
      }
    }

    // Update fields
    company.name = name.trim();
    company.place = place || '';
    company.contactEmail = contactEmail || '';
    company.contactPhone = contactPhone || '';
    // Note: createdBy should not be changed

    await company.save();

    res.json({
      success: true,
      message: 'Company updated successfully',
      data: company,
    });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating company',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
