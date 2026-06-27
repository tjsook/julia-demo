import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../lib/authOptions";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const title = String(req.body?.title ?? "").trim();
  const description = String(req.body?.description ?? "").trim();
  const area = String(req.body?.area ?? "").trim();

  if (!title || !description || !area) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const apiKey = process.env.LINEAR_API_KEY;
  const teamId = process.env.LINEAR_TEAM_ID;
  const projectId = process.env.LINEAR_PROJECT_ID;

  if (!apiKey || !teamId || !projectId) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id title url }
      }
    }
  `;

  const variables = {
    input: {
      teamId,
      projectId,
      title: `SUPPORT TICKET: ${title}`,
      description: `${description}\n\n---\nSubmitted via Diesel Dashboard\n- Area: ${area}`,
    },
  };

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    const data = await response.json();

    if (data.errors || !data.data?.issueCreate?.success) {
      return res.status(500).json({ error: "Failed to create Linear issue" });
    }

    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}
