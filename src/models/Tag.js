const mongoose = require('mongoose');

const TagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a tag name'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for case-insensitive search
TagSchema.index({ name: 1 });

module.exports = mongoose.model('Tag', TagSchema);
