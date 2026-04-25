const mongoose = require('mongoose');

const MachineTaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a task title'],
      trim: true,
    },
    body: {
      type: String,
      required: [true, 'Please provide task description'],
    },
    techStack: [
      {
        type: String,
        enum: ['MERN', 'Python', 'Dotnet', 'Frontend', 'GoLang', 'JAVA', 'Flutter', 'DA', 'DS', 'Testing'],
      },
    ],
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tag',
      },
    ],
    files: [
      {
        url: String,
        public_id: String,
        originalName: String,
        mimetype: String,
        size: Number,
        // Keep 'path' for backward compatibility with old local files
        path: { type: String, default: '' },
      },
    ],
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for search optimization
MachineTaskSchema.index({ title: 'text', body: 'text' });
MachineTaskSchema.index({ company: 1 });
MachineTaskSchema.index({ techStack: 1 });
MachineTaskSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MachineTask', MachineTaskSchema);
