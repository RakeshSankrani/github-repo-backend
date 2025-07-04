import express from 'express';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const {
  GITHUB_APP_ID,
  GITHUB_INSTALLATION_ID,
  GITHUB_PRIVATE_KEY,
} = process.env;

if (!GITHUB_APP_ID || !GITHUB_INSTALLATION_ID || !GITHUB_PRIVATE_KEY) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

function generateAppJWT() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + 540, // 9 minutes (GitHub requires <10 min)
    iss: GITHUB_APP_ID,
  };
  return jwt.sign(payload, GITHUB_PRIVATE_KEY, { algorithm: 'RS256' });
}

async function getInstallationAccessToken(jwtToken) {
  const res = await axios.post(
    `https://api.github.com/app/installations/${GITHUB_INSTALLATION_ID}/access_tokens`,
    {},
    {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );
  return res.data.token;
}

app.post('/api/repo-data', async (req, res) => {
  const { owner, name } = req.body;

  if (!owner || !name) {
    return res.status(400).json({ error: 'Missing owner or name in request body' });
  }

  try {
    const jwtToken = generateAppJWT();
    const installationToken = await getInstallationAccessToken(jwtToken);

    const query = `
      query {
        repository(owner: "${owner}", name: "${name}") {
          name
          description
          stargazerCount
          createdAt
          issues(states: OPEN) { totalCount }
          closedIssues: issues(states: CLOSED) { totalCount }
          updatedAt
          owner { login }
          releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
            nodes {
              tagName
              publishedAt
            }
          }
        }
      }
    `;

    const githubRes = await axios.post(
      'https://api.github.com/graphql',
      { query },
      {
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    const repository = githubRes.data.data.repository;

    res.json({
      ...repository,
      latestRelease: repository.releases?.nodes?.[0] || null,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch repo data' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
