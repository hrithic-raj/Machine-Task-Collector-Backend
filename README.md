# Machine Task Collector

A full-stack web application for interns to collect and search machine tasks from companies.

## Features

- **Authentication**: Secure login/signup with email verification
- **Company Management**: Create or select existing companies
- **Task CRUD**: Add, view, edit, and delete machine tasks
- **Rich Text**: Tiptap editor for formatted task descriptions
- **File Uploads**: Support for images and PDF files (max 5MB each, up to 10 files)
- **Tag System**: Reusable tags across tasks with search and create
- **Search & Filter**: Search by company name/task title, filter by tech stack
- **Pagination**: Browse through large sets of tasks

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS, Tiptap
- **Backend**: Node.js, Express.js, MongoDB, JWT, Multer, Nodemailer
- **Database**: MongoDB

## Project Structure

```
.
├── backend/           # Express.js API server
│   ├── src/
│   │   ├── config/      # Database configuration
│   │   ├── middleware/  # Auth & file upload middleware
│   │   ├── models/      # Mongoose schemas
│   │   ├── routes/      # API routes
│   │   └── server.js    # Express server entry point
│   └── package.json
│
├── frontend/          # Next.js application
│   ├── src/
│   │   ├── app/         # App Router pages
│   │   ├── components/  # React components
│   │   │   ├── common/
│   │   │   ├── forms/
│   │   │   └── ui/
│   │   ├── lib/         # API client, auth context, constants
│   │   └── styles/      # Global CSS
│   └── package.json
│
└── README.md
```

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or Atlas)

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Edit `.env` and configure:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/machine_task_db
JWT_SECRET=your_random_secret_key_here
JWT_EXPIRE=7d

# Email configuration (for verification)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
FROM_EMAIL=noreply@machinetaskcollector.com
FROM_NAME=Machine Task Collector
APP_URL=http://localhost:3000

# File upload
MAX_FILE_SIZE=5000000
UPLOAD_PATH=uploads/
```

**Note**: For Gmail, you need to create an App Password (2FA required) or use "Less secure app access" (not recommended). Alternatively, use any SMTP service.

Run MongoDB locally:
```bash
# If installing MongoDB locally, ensure it's running
mongod
```

Or use MongoDB Atlas (cloud) and update `MONGODB_URI` with your connection string.

Start the backend server:
```bash
npm run dev
# or for production
npm start
```

The API will run on http://localhost:5000

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

Start the frontend development server:
```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user (email verification required)
- `GET /api/auth/verify-email/:token` - Verify email address
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user (clears cookie)
- `GET /api/auth/me` - Get current user

### Companies
- `GET /api/companies?search=` - List/search companies
- `POST /api/companies` - Create new company
- `GET /api/companies/:id` - Get single company

### Tags
- `GET /api/tags?search=` - List/search tags
- `POST /api/tags` - Create new tag
- `GET /api/tags/:id` - Get single tag

### Tasks
- `GET /api/tasks?search=&techStack=&page=&limit=` - Get tasks with search, filter, pagination
- `POST /api/tasks` - Create new task (with file uploads)
- `GET /api/tasks/:id` - Get single task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

## Tech Stacks

The application supports the following tech stack filters:
- MERN
- Python
- Dotnet
- Frontend
- GoLang
- JAVA

## Default Credentials

No default admin user. Register as a new intern via the signup page. Email verification is required before you can log in.

## Testing the Application

1. **Register**: Go to http://localhost:3000/signup and create an account
2. **Verify Email**: Check your inbox (or console logs if using a dev SMTP) and click the verification link (or manually verify via API)
3. **Login**: Use your credentials to log in
4. **Add Task**:
   - Click "+ Add New Task"
   - Select an existing company or create a new one
   - Enter task details with rich text formatting
   - Select tech stack(s)
   - Add existing tags or create new ones
   - Upload files (images/PDF)
   - Submit
5. **Search & Filter**:
   - Use the search bar to find tasks by company name or title
   - Click tech stack buttons to filter by specific technologies
   - Use pagination to browse through tasks

## Folder Structure Details

### Backend
- `src/models/`: Mongoose schemas for User, Company, Tag, MachineTask
- `src/routes/`: RESTful API endpoints
- `src/middleware/`: Authentication (JWT) and file upload (Multer) middleware
- `src/config/`: Database connection setup

### Frontend
- `src/app/`: Next.js App Router pages (layout, login, signup, dashboard)
- `src/components/`:
  - `ui/`: Reusable UI components (Button, Input, Modal, Pagination)
  - `common/`: Feature-specific components (TaskCard, TaskList, SearchBar)
  - `forms/`: Form components (TaskForm, RichTextEditor, FileUploader, CompanySelect, TagSelector)
- `src/lib/`: API client, authentication context, constants

## Security Features

- Passwords hashed with bcrypt
- HTTP-only cookies for JWT storage
- Email verification required
- File type and size validation (images & PDFs only, max 5MB)
- Protected API routes with JWT middleware
- CORS configured for specific origin

## Notes

- The email verification feature requires a working SMTP server. For development, you can use ethereal.email (fake SMTP) or console.log the verification link in the nodemailer transport.
- Files are stored in the `backend/uploads/` directory. In production, consider using cloud storage (S3, Cloudinary, etc.).
- The application uses case-insensitive search for company names and tags to prevent duplicates.
- Task deletion also removes associated files from the server.

## Development Tips

- To bypass email verification during development, comment out the `isVerified` check in `backend/src/middleware/auth.js`.
- To debug SMTP issues, add `logger: true` to the nodemailer transporter config in `auth.js`.
- The Tiptap editor uses the StarterKit extension for basic formatting. You can extend it with more features as needed.

## License

ISC

