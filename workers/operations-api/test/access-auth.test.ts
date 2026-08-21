import assert from "node:assert/strict";
import test from "node:test";

import {
  accessActorFromClaims,
} from "../src/access-auth";

test("Access actor prefers a member email", () => {
  assert.deepEqual(
    accessActorFromClaims({
      email: "member@example.com",
      sub: "member-subject",
      common_name: "service-client.access",
    }),
    {
      actorId: "member@example.com",
      actorType: "member",
    },
  );
});

test("Access actor uses a non-empty member subject", () => {
  assert.deepEqual(
    accessActorFromClaims({
      sub: "member-subject",
    }),
    {
      actorId: "member-subject",
      actorType: "member",
    },
  );
});

test("Access service token uses common_name", () => {
  assert.deepEqual(
    accessActorFromClaims({
      sub: "",
      common_name: "service-client.access",
    }),
    {
      actorId: "service-client.access",
      actorType: "service",
    },
  );
});

test("Access actor rejects empty identity claims", () => {
  assert.throws(
    () => accessActorFromClaims({
      email: " ",
      sub: "",
      common_name: " ",
    }),
    /access_jwt_actor_missing/,
  );
});
