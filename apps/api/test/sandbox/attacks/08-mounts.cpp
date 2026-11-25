// Looks for the Docker socket and for any mount Docker does not create by itself.
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <unistd.h>

int main() {
  bool found = access("/var/run/docker.sock", F_OK) == 0 || access("/run/docker.sock", F_OK) == 0;
  const std::set<std::string> own{"/", "/tmp", "/etc/resolv.conf", "/etc/hostname", "/etc/hosts"};
  std::ifstream mounts("/proc/self/mountinfo");
  std::string line;
  int seen = 0;
  while (std::getline(mounts, line)) {
    std::istringstream fields(line);
    std::string id, parent, device, root, point;
    fields >> id >> parent >> device >> root >> point;
    ++seen;
    bool system = point.rfind("/proc", 0) == 0 || point.rfind("/sys", 0) == 0 || point.rfind("/dev", 0) == 0;
    if (!system && own.count(point) == 0) found = true;
  }
  std::cout << (seen == 0 ? "unreadable" : found ? "host visible" : "nothing") << "\n";
}
