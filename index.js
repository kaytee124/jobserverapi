const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
require('dotenv').config();

// Middleware here
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@job-portal.wxmniyc.mongodb.net/?retryWrites=true&w=majority&appName=Job-portal`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db("jobPortal");
    const jobsCollection = db.collection("jobs");
    const cvCollection = db.collection("cv"); // New collection for CVs
    const usersCollection = db.collection("users"); // New collection for Users

    // Creating index for job sorting last job posted will show first
    const indexKeys = { title: 1, category: 1 }; 
    const indexOptions = { name: "titleCategory" }; 
    const result = await jobsCollection.createIndex(indexKeys, indexOptions);

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

    // Handle CV submission for a job
    app.post("/all-jobs/:id", async (req, res) => {
      const jobId = req.params.id;
      const { cvUrl, email } = req.body; // Get email from request body

      // Insert the CV URL and email into the CV collection
      const cvData = {
        jobId: new ObjectId(jobId),
        cvUrl: cvUrl,
        email: email, // Include email in cvData
        submittedAt: new Date(),
      };

      const result = await cvCollection.insertOne(cvData);
      if (result?.insertedId) {
        res.status(200).send(result);
      } else {
        res.status(404).send({
          message: "Cannot submit CV, try again later",
          status: false,
        });
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
        CompanyName: userType === 'employer' ? CompanyName : null, // Only include CompanyName for employers
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
        res.status(404).send({
          message: "Cannot register user, try again later",
          status: false,
        });
      }
    });
  
    // Login endpoint
    const jwt = require('jsonwebtoken');
    const secretKey = 'your_secret_key';

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
          token, // Return the token
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
