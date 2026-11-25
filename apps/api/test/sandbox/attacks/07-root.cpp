#include <iostream>
#include <unistd.h>

int main() { std::cout << (getuid() == 0 || geteuid() == 0 ? "root" : "unprivileged") << "\n"; }
