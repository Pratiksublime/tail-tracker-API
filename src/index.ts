import flash from "connect-flash";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import ejs from "ejs";
import express, { NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import session from "express-session";
import createError from "http-errors";
import logger from "morgan";
import path from "path";

// --- REDIS INITIALIZATION ---
import "./lib/redis";
// ----------------------------

dotenv.config();

// Route Imports
import adminComplaintRoutes from "./module/Admin/Complaint/routes";
import adminIntakeRoutes from "./module/Admin/Intake/routes";
import adminOrganizations from "./module/Admin/Organizations/routes";
import adminQrGenerator from "./module/Admin/QrGenerator/routes";
import adminShelters from "./module/Admin/Shelters/routes";
import adminUsers from "./module/Admin/Users/routes";
import mobileAuth from "./module/Mobile/Auth/routes";
import mobileDogsRoutes from "./module/Mobile/Dogs/routes";
import mobileIntakeRoutes from "./module/Mobile/Intake/routes";

const app = express();

// 1. Basic Middleware & Security
app.use(logger("dev"));
app.use(cors());
app.use(cookieParser());

// 2. File Upload (must run before body parsers for multipart/form-data)
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB Limit
}));

// 3. Body Parsers
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// 4. Session & Flash
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(flash());

// 5. Flash messages & Locals middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.locals.currentUser = (req as any).user;
  res.locals.error = req.flash("error");
  res.locals.success = req.flash("success");
  next();
});

// 6. View engine setup
app.set("views", path.join(__dirname, "views"));
app.engine("html", ejs.renderFile);
app.set("view engine", "html");

// 7. Static Files
app.use(express.static(path.join(process.cwd(), "public")));
app.use('/uploads', express.static(path.join(process.cwd(), 'public/uploads')));

// 8. API Routes
app.use("/api/v1/auth", mobileAuth);
app.use("/api/v1/dogs", mobileDogsRoutes);
app.use("/api/v1/intake", mobileIntakeRoutes);
app.use("/api/v1/admin/intake", adminIntakeRoutes);
app.use("/api/v1/admin/complaint", adminComplaintRoutes);

// Admin Routes
app.use("/api/v1/admin/users", adminUsers);
app.use("/api/v1/admin/organizations", adminOrganizations);
app.use("/api/v1/admin/shelters", adminShelters);
app.use("/api/v1/admin/qr-generator", adminQrGenerator);

// 9. Error handling
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404));
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  res.status(err.status || 500);
  res.send({
    success: false,
    message: err.message || "Internal Server Error",
    data: [err]
  });
});

export default app;
