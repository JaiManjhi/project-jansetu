import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
const uri = fs.readFileSync(".env.local","utf8").match(/^MONGODB_URI=(.*)$/m)[1].trim();
const pw = process.argv[2];
await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection.db;
const nit = await db.collection("institutions").findOne({ name: /NIT Jamshedpur/i });
const hash = await bcrypt.hash(pw, 10);
const mk = async (email, role, institutionId=null) => {
  await db.collection("users").deleteOne({ email });
  await db.collection("users").insertOne({ email, role, name:`temp ${role}`, passwordHash:hash,
    institutionId, createdAt:new Date(), updatedAt:new Date() });
};
await mk("t.uni@example.com","university", nit._id);
await mk("t.ind@example.com","industry");
await mk("t.adm@example.com","admin");
console.log("NIT_ID=" + nit._id.toString());
const q = await db.collection("matches").aggregate([
  { $match: { institutionId: nit._id } },
  { $lookup:{from:"problems",localField:"problemId",foreignField:"_id",as:"p"} },
  { $unwind:"$p" }, { $match:{ "p.status":"routed" } }, { $limit: 3 },
]).toArray();
q.forEach(m => console.log(`QUEUE_ITEM=${m.problemId} rank=${m.rank} ${m.p.title.slice(0,50)}`));
await mongoose.disconnect();
