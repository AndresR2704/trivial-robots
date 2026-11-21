// Les commandes texte doivent rester exactement celles attendues par le firmware maître.
import assert from "node:assert/strict";
import { it } from "node:test";
import { cmd } from "../src/link/commands.ts";

it("format des commandes tablette -> maître", () => {
  assert.equal(cmd.move(3, "LEFT"), "MOVE 3 LEFT");
  assert.equal(cmd.move("ALL", "UP"), "MOVE ALL UP");
  assert.equal(cmd.anim("ALL"), "ANIM ALL");
  assert.equal(cmd.anim(2), "ANIM 2");
  assert.equal(cmd.win(5), "WIN 5");
  assert.equal(cmd.stop("ALL"), "STOP ALL");
  assert.equal(cmd.ping(), "PING");
});
