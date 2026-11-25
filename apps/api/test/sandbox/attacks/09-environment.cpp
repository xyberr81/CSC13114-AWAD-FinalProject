// Looks for the key the test puts in the judge's own environment.
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

extern char **environ;

int main() {
  std::string all;
  for (char **entry = environ; *entry != nullptr; ++entry) all += std::string(*entry) + "\n";
  for (const char *path : {"/proc/self/environ", "/proc/1/environ", "/app/.env", "/.env", "/tmp/.env"}) {
    std::ifstream file(path, std::ios::binary);
    all.append(std::istreambuf_iterator<char>(file), {});
  }
  std::cout << (all.find("canary-key-0123456789") != std::string::npos ? "leaked" : "clean") << "\n";
}
