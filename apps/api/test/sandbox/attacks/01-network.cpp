// Opens a socket to the outside. A naive container connects.
#include <arpa/inet.h>
#include <fcntl.h>
#include <iostream>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

int main() {
  int fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
  sockaddr_in to{};
  to.sin_family = AF_INET;
  to.sin_port = htons(80);
  inet_pton(AF_INET, "1.1.1.1", &to.sin_addr);
  int error = 0;
  if (connect(fd, reinterpret_cast<sockaddr *>(&to), sizeof to) != 0) {
    pollfd p{fd, POLLOUT, 0};
    socklen_t size = sizeof error;
    if (poll(&p, 1, 800) != 1 || getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) != 0) error = 1;
  }
  std::cout << (fd >= 0 && error == 0 ? "connected" : "blocked") << "\n";
}
