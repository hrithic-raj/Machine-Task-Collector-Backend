const cloudinary = require('cloudinary');

// Validate required environment variables
const requiredEnvVars = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(
    `Missing Cloudinary environment variables: ${missingVars.join(', ')}`
  );
  console.error('Please set these in your .env file');
}

// Configure Cloudinary using environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a file to Cloudinary
 * @param {String|Buffer} filePath - Path to file (string) or file buffer
 * @param {Object} options - Upload options
 * @param {String} options.folder - Cloudinary folder (default: 'MachineTasks')
 * @param {String} options.resource_type - 'image', 'video', 'raw', or 'auto' (default: 'auto')
 * @returns {Promise<Object>} Cloudinary upload response with url, public_id, etc.
 */
const uploadToCloudinary = (filePath, options = {}) => {
  const {
    folder = 'machinetasks',
    resource_type = 'auto',
    type = 'upload',
    ...rest
  } = options;

  const uploadOptions = {
    folder,
    resource_type,
    type,
    access_mode: 'public', // Ensure files are publicly accessible
    ...rest,
  };

  console.log('Cloudinary upload config:', uploadOptions);

  // Cloudinary's upload method returns a promise in SDK v2
  return cloudinary.uploader.upload(filePath, uploadOptions);
};

/**
 * Delete a file from Cloudinary by public_id
 * @param {String} publicId - The Cloudinary public_id
 * @returns {Promise<Object>} Deletion result
 */
const deleteFromCloudinary = (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
};
