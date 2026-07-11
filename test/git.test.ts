import { describe, expect, it } from "vitest";
import { parseRemoteUrl } from "../src/git.js";

describe("parseRemoteUrl", () => {
  it("parses HTTPS remotes with and without .git", () => {
    expect(parseRemoteUrl("https://git.example.com/owner/repo.git")).toEqual({
      host: "git.example.com",
      owner: "owner",
      name: "repo",
    });
    expect(parseRemoteUrl("https://git.example.com/owner/repo")).toEqual({
      host: "git.example.com",
      owner: "owner",
      name: "repo",
    });
  });

  it("parses HTTP remotes with a port", () => {
    expect(parseRemoteUrl("http://git.example.com:3000/owner/repo.git")).toEqual({
      host: "git.example.com",
      owner: "owner",
      name: "repo",
    });
  });

  it("parses scp-form SSH remotes", () => {
    expect(parseRemoteUrl("git@git.example.com:owner/repo.git")).toEqual({
      host: "git.example.com",
      owner: "owner",
      name: "repo",
    });
    expect(parseRemoteUrl("git.example.com:owner/repo")).toEqual({
      host: "git.example.com",
      owner: "owner",
      name: "repo",
    });
  });

  it("parses ssh:// remotes with a port", () => {
    expect(parseRemoteUrl("ssh://git@git.example.com:2222/owner/repo.git")).toEqual({
      host: "git.example.com",
      owner: "owner",
      name: "repo",
    });
  });

  it("rejects URLs without an owner/name path", () => {
    expect(parseRemoteUrl("https://git.example.com/owner")).toBeNull();
    expect(parseRemoteUrl("https://git.example.com/a/b/c")).toBeNull();
    expect(parseRemoteUrl("not a url")).toBeNull();
    expect(parseRemoteUrl("/local/path/repo.git")).toBeNull();
  });
});
