// Starts children until it is refused. It stops at 64, so that a run without the limit is harmless.
#include <csignal>
#include <iostream>
#include <unistd.h>
#include <vector>

int main() {
  std::vector<pid_t> children;
  while (children.size() < 64) {
    pid_t pid = fork();
    if (pid < 0) break;
    if (pid == 0)
      for (;;) pause();
    children.push_back(pid);
  }
  for (pid_t pid : children) kill(pid, SIGKILL);
  std::cout << (children.size() < 16 ? "limited" : "unlimited") << "\n";
}
