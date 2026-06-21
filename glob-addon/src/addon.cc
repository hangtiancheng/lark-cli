#include <algorithm>
#include <filesystem>
#include <napi.h>
#include <string>
#include <unordered_set>
#include <vector>

namespace fs = std::filesystem;

// ---------------------------------------------------------------------------
// Glob matching (supports *, **, ?, literal characters)
// ---------------------------------------------------------------------------

static bool matchFrom(const std::string &pattern, size_t pi,
                      const std::string &text, size_t ti) {
  while (pi < pattern.size() && ti < text.size()) {
    char pc = pattern[pi];

    if (pc == '*' && pi + 1 < pattern.size() && pattern[pi + 1] == '*') {
      // ** globstar: match zero or more path segments
      size_t afterStars = pi + 2;

      if (afterStars == pattern.size()) {
        return true; // trailing ** matches everything
      }

      bool hasSlash =
          (afterStars < pattern.size() && pattern[afterStars] == '/');
      size_t restPi = hasSlash ? afterStars + 1 : afterStars;

      // Try ** matching 0 segments
      {
        size_t startI = ti;
        if (hasSlash && startI < text.size() && text[startI] == '/') {
          startI++;
        }
        if (matchFrom(pattern, restPi, text, startI))
          return true;
      }
      // Try ** matching 1, 2, ... segments (advance past each /)
      for (size_t i = ti; i < text.size(); ++i) {
        if (text[i] == '/') {
          size_t nextI = i + 1;
          if (matchFrom(pattern, restPi, text, nextI))
            return true;
        }
      }
      return false;

    } else if (pc == '*') {
      // * single star: match any chars except '/'
      size_t restPi = pi + 1;
      for (size_t i = ti; i <= text.size(); ++i) {
        if (matchFrom(pattern, restPi, text, i))
          return true;
        if (i < text.size() && text[i] == '/')
          break;
      }
      return false;

    } else if (pc == '?') {
      if (text[ti] == '/')
        return false;
      ++pi;
      ++ti;

    } else {
      if (pc != text[ti])
        return false;
      ++pi;
      ++ti;
    }
  }

  // consume trailing wildcards
  while (pi < pattern.size() && pattern[pi] == '*')
    ++pi;

  return pi == pattern.size() && ti == text.size();
}

static bool globMatchImpl(const std::string &pattern, const std::string &text) {
  return matchFrom(pattern, 0, text, 0);
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

static void scanDir(const fs::path &dir, const fs::path &rootDir,
                    const std::string &pattern, bool hasSlash,
                    const std::unordered_set<std::string> &excludeDirs,
                    bool includeDot, size_t maxResults,
                    std::vector<std::string> &results) {
  if (results.size() >= maxResults)
    return;

  std::vector<fs::directory_entry> entries;
  std::error_code ec;

  for (auto &entry : fs::directory_iterator(dir, ec)) {
    entries.push_back(entry);
  }

  std::sort(entries.begin(), entries.end(),
            [](const fs::directory_entry &a, const fs::directory_entry &b) {
              return a.path().filename() < b.path().filename();
            });

  for (auto &entry : entries) {
    if (results.size() >= maxResults)
      return;

    std::string name = entry.path().filename().string();

    if (entry.is_directory()) {
      if (!includeDot && !name.empty() && name[0] == '.')
        continue;
      if (excludeDirs.count(name))
        continue;
      scanDir(entry.path(), rootDir, pattern, hasSlash, excludeDirs, includeDot,
              maxResults, results);

    } else if (entry.is_regular_file()) {
      if (!includeDot && !name.empty() && name[0] == '.')
        continue;

      std::string relativePath =
          fs::relative(entry.path(), rootDir, ec).string();

      const std::string &matchTarget = hasSlash ? relativePath : name;

      if (globMatchImpl(pattern, matchTarget)) {
        results.push_back(relativePath);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// N-API exports
// ---------------------------------------------------------------------------

Napi::Value GlobMatch(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "Expected (pattern: string, text: string)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string pattern = info[0].As<Napi::String>().Utf8Value();
  std::string text = info[1].As<Napi::String>().Utf8Value();

  return Napi::Boolean::New(env, globMatchImpl(pattern, text));
}

Napi::Value GlobScan(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "First argument (pattern) must be a string")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string pattern = info[0].As<Napi::String>().Utf8Value();

  std::string cwdStr = ".";
  if (info.Length() > 1 && info[1].IsString()) {
    cwdStr = info[1].As<Napi::String>().Utf8Value();
  }

  std::unordered_set<std::string> excludeDirs;
  if (info.Length() > 2 && info[2].IsArray()) {
    Napi::Array arr = info[2].As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); ++i) {
      Napi::Value v = arr[i];
      if (v.IsString()) {
        excludeDirs.insert(v.As<Napi::String>().Utf8Value());
      }
    }
  }

  bool includeDot = false;
  if (info.Length() > 3 && info[3].IsBoolean()) {
    includeDot = info[3].As<Napi::Boolean>().Value();
  }

  uint32_t maxResults = 1000;
  if (info.Length() > 4 && info[4].IsNumber()) {
    maxResults = info[4].As<Napi::Number>().Uint32Value();
  }

  bool hasSlash = pattern.find('/') != std::string::npos;
  fs::path cwdPath = fs::absolute(cwdStr).lexically_normal();
  std::vector<std::string> results;

  scanDir(cwdPath, cwdPath, pattern, hasSlash, excludeDirs, includeDot,
          maxResults, results);

  Napi::Array arr = Napi::Array::New(env, results.size());
  for (size_t i = 0; i < results.size(); ++i) {
    arr[i] = Napi::String::New(env, results[i]);
  }

  return arr;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("globMatch", Napi::Function::New(env, GlobMatch));
  exports.Set("globScan", Napi::Function::New(env, GlobScan));
  return exports;
}

NODE_API_MODULE(glob_addon, Init)
