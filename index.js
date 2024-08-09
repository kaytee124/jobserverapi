const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const multer = require('multer'); // For handling file uploads
const pdfParse = require('pdf-parse'); // For extracting text from PDFs
const axios = require('axios');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();
const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(cors());

// Multer setup for handling PDF uploads
const upload = multer({ dest: 'uploads/' });

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@job-portal.wxmniyc.mongodb.net/?retryWrites=true&w=majority&appName=Job-portal`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const secretKey = 'your_secret_key'; // JWT Secret Key

async function run() {
  try {
    await client.connect();

    const db = client.db("jobPortal");
    const jobsCollection = db.collection("jobs");
    const cvCollection = db.collection("cv");
    const usersCollection = db.collection("users");

    // Creating index for job sorting last job posted will show first
    const indexKeys = { title: 1, category: 1 };
    const indexOptions = { name: "titleCategory" };
    await jobsCollection.createIndex(indexKeys, indexOptions);

    // Post a job
    app.post("/post-job", async (req, res) => {
      const body = req.body;
      body.createdAt = new Date();
      const result = await jobsCollection.insertOne(body);
      if (result?.insertedId) {
        return res.status(200).send(result);
      } else {
        return res.status(404).send({
          message: "cannot insert, try again later",
          status: false,
        });
      }
    });

    // Get all jobs
    app.get("/all-jobs", async (req, res) => {
      const jobs = await jobsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.send(jobs);
    });

    // Get single job using id
    app.get("/all-jobs/:id", async (req, res) => {
      const jobId = req.params.id;
      const job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });
      if (job) {
        res.status(200).send(job);
      } else {
        res.status(404).send({
          message: "Job not found",
          status: false,
        });
      }
    });

    // Handle CV submission for a job with skill matching
    app.post("/all-jobs/:id", upload.single('cv'), async (req, res) => {
      const jobId = req.params.id;
      const { email } = req.body; // Get email from request body
      const job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });

      if (!job) {
        return res.status(404).send({
          message: "Job not found",
          status: false,
        });
      }

      if (!req.file) {
        return res.status(400).send({
          message: "No CV file uploaded",
          status: false,
        });
      }

      try {
        // Read the uploaded file
        const dataBuffer = fs.readFileSync(req.file.path);
        // Extract text from PDF
        const pdfData = await pdfParse(dataBuffer);
        const cvText = pdfData.text;

        // Extract actual skill names from the job's skills array
        const jobSkills = job.skills.map(skillObj => skillObj.value); // Assuming each skill object has a 'name' field

        // Match CV skills with job skills using OpenAI API
        const openAIResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4',
            messages: [
              { role: 'system', content: 'You are an assistant that matches job skills.' },
              { role: 'user', content: `Job skills:\n${jobSkills.join(", ")}\n\nCV Text:\n${cvText}\n\nDoes the CV contain at least 60% of the required skills?` }
            ],
            temperature: 0.7,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
          }
        );

        const botMessage = openAIResponse.data.choices[0].message.content.trim().toLowerCase();
        console.log("OpenAI Response:", botMessage); // Debugging log

        // Store the CV and the match result in the database
        const cvData = {
          jobId: new ObjectId(jobId),
          email,
          cvText,
          matchResult: botMessage.includes('yes'),
          submittedAt: new Date(),
        };

        const result = await cvCollection.insertOne(cvData);
        console.log("Insert Result:", result); // Debugging log

        if (result?.insertedId) {
          res.status(200).send({
            message: "CV submitted successfully",
            match: cvData.matchResult,
          });
        } else {
          res.status(500).send({
            message: "Cannot submit CV, try again later",
            status: false,
          });
        }
      } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.status(500).send({ error: 'Something went wrong!' });
      } finally {
        // Clean up the uploaded file
        fs.unlinkSync(req.file.path);
      }
    });

    // Get jobs based on email for my job listing 
    app.get("/myJobs/:email", async (req, res) => {
      const jobs = await jobsCollection
        .find({
          postedBy: req.params.email,
        })
        .toArray();
      res.send(jobs);
    });

    // Register user and create the users collection if it doesn't exist
    app.post("/register", async (req, res) => {
      const { userType, Firstname, Lastname, DateOfBirth, Gender, Email, PhoneNumber, Origin, CompanyName, Password } = req.body;

      const userData = {
        userType,
        Firstname,
        Lastname,
        DateOfBirth,
        Gender,
        Email,
        PhoneNumber,
        Origin,
        CompanyName: userType === 'employer' ? CompanyName : null,
        Password,
        createdAt: new Date(),
      };

      const existingUser = await usersCollection.findOne({ Email });

      if (existingUser) {
        return res.status(400).send({
          message: "User already exists with this email address",
          status: false,
        });
      }

      const result = await usersCollection.insertOne(userData);
      if (result?.insertedId) {
        res.status(200).send(result);
      } else {
        return res.status(404).send({
          message: "Cannot register user, try again later",
          status: false,
        });
      }
    });

    // Login endpoint
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;

      try {
        const user = await usersCollection.findOne({ Email: email });

        if (!user || user.Password !== password) {
          return res.status(401).send({
            message: "Invalid credentials",
            status: false,
          });
        }

        const token = jwt.sign({ email: user.Email, userType: user.userType }, secretKey, { expiresIn: '1h' });

        return res.status(200).send({
          message: "Login successful",
          status: true,
          token,
          user,
        });
      } catch (error) {
        return res.status(500).send({
          message: "An error occurred during login",
          status: false,
        });
      }
    });

    // Delete job using id
    app.delete("/delete-job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/", (req, res) => {
      res.send("Job Portal Server is running");
    });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Do not close the connection
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Job Portal Server is running on port ${port}`);
});
