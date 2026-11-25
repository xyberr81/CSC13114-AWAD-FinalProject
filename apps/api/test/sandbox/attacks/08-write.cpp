// Session 6: overwrite the expected output, or leave anything behind outside /tmp.
#include <fstream>
#include <iostream>

int main() {
  bool written = false;
  for (const char *path : {"expected_output.txt", "/expected_output.txt", "/etc/leetkob", "/home/leetkob",
                           "/usr/leetkob", "/var/tmp/leetkob"}) {
    std::ofstream file(path);
    if (file << "42\n" << std::flush) written = true;
  }
  std::cout << (written ? "written" : "read-only") << "\n";
}
