const express = require('express');
const router = express.Router();
const User = require('../models/User');
const MachineTask = require('../models/MachineTask');
const Company = require('../models/Company');
const { protect, authorize } = require('../middleware/auth');

// GET /api/admin/statistics - Get admin dashboard statistics
router.get('/statistics', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    // Get user statistics
    const totalUsers = await User.countDocuments();
    const internCount = await User.countDocuments({ role: 'intern' });
    const adminCount = await User.countDocuments({ role: 'admin' });
    const superAdminCount = await User.countDocuments({ role: 'super_admin' });
    const pendingApprovalCount = await User.countDocuments({ role: 'intern', isApproved: false, isVerified: true });
    const blockedUsersCount = await User.countDocuments({ isBlocked: true });

    // Get task statistics
    const totalTasks = await MachineTask.countDocuments();
    const tasksByTechStack = await MachineTask.aggregate([
      { $unwind: '$techStack' },
      { $group: { _id: '$techStack', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Get recent registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentRegistrations = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    // Get recent tasks (last 7 days)
    const recentTasks = await MachineTask.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });

    // Get company statistics
    const totalCompanies = await Company.countDocuments();

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          interns: internCount,
          admins: adminCount,
          superAdmins: superAdminCount,
          pendingApproval: pendingApprovalCount,
          blocked: blockedUsersCount,
        },
        tasks: {
          total: totalTasks,
          recent: recentTasks,
          byTechStack: tasksByTechStack,
        },
        companies: {
          total: totalCompanies,
        },
        recentRegistrations,
      },
    });
  } catch (error) {
    console.error('Admin statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/admin/users - Get all users with filtering
router.get('/users', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const {
      role,
      isApproved,
      isBlocked,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    let query = {};

    // Apply filters
    if (role && ['intern', 'admin', 'super_admin'].includes(role)) {
      query.role = role;
    }
    if (isApproved !== undefined) {
      query.isApproved = isApproved === 'true';
    }
    if (isBlocked !== undefined) {
      query.isBlocked = isBlocked === 'true';
    }

    // Search by name or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(query)
      .select('-password -verificationToken -verificationExpires')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      data: users,
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/admin/users/:id - Get single user details
router.get('/users/:id', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -verificationToken -verificationExpires')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get user's tasks
    const tasks = await MachineTask.find({ submittedBy: user._id })
      .populate('company', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        user,
        recentTasks: tasks,
      },
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// PUT /api/admin/users/:id/approve - Approve a user (for intern role)
router.put('/users/:id/approve', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Only interns can be approved
    if (user.role !== 'intern') {
      return res.status(400).json({
        success: false,
        message: 'Only interns require approval',
      });
    }

    user.isApproved = true;
    await user.save();

    res.json({
      success: true,
      message: 'User approved successfully',
      data: user,
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// PUT /api/admin/users/:id/reject - Reject a user (for intern role)
router.put('/users/:id/reject', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Only interns can be rejected
    if (user.role !== 'intern') {
      return res.status(400).json({
        success: false,
        message: 'Only interns can be rejected',
      });
    }

    // Set isApproved to false (could also delete user, but keeping data for records)
    user.isApproved = false;
    await user.save();

    res.json({
      success: true,
      message: 'User rejected successfully',
      data: user,
    });
  } catch (error) {
    console.error('Reject user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while rejecting user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// PUT /api/admin/users/:id/block - Block a user
router.put('/users/:id/block', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Cannot block super_admins (only another super_admin can)
    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot block a super admin',
      });
    }

    // Cannot block yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot block yourself',
      });
    }

    user.isBlocked = true;
    user.blockedAt = new Date();
    user.blockedBy = req.user._id;
    await user.save();

    res.json({
      success: true,
      message: 'User blocked successfully',
      data: user,
    });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while blocking user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// PUT /api/admin/users/:id/unblock - Unblock a user
router.put('/users/:id/unblock', protect, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.isBlocked = false;
    user.blockedAt = undefined;
    user.blockedBy = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'User unblocked successfully',
      data: user,
    });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while unblocking user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// PUT /api/admin/users/:id/role - Change user role
router.put('/users/:id/role', protect, authorize('super_admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Validate role
    if (!['intern', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be intern, admin, or super_admin',
      });
    }

    // Only super_admins can create other super_admins
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can assign super admin role',
      });
    }

    // Cannot promote yourself to super_admin if you're not already
    if (user._id.toString() === req.user._id.toString() && role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot promote yourself to super admin',
      });
    }

    // If changing to admin/super_admin, automatically approve the user
    if (role !== 'intern') {
      user.isApproved = true;
    }

    user.role = role;
    await user.save();

    res.json({
      success: true,
      message: `User role changed to ${role} successfully`,
      data: user,
    });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while changing user role',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
