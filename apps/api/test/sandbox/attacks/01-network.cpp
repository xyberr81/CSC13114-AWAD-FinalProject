// Opens a socket to the outside. A naive container connects.
#include <arpa/inet.h>
#include <cerrno>
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
  bool connected = connect(fd, reinterpret_cast<sockaddr *>(&to), sizeof to) == 0;
  // Only a connection in progress can still succeed: a refused one also polls as writable, and its
  // SO_ERROR is 0.
  if (!connected && errno == EINPROGRESS) {
    pollfd p{fd, POLLOUT, 0};
    int error = 0;
    socklen_t size = sizeof error;
    connected = poll(&p, 1, 800) == 1 && (p.revents & (POLLERR | POLLHUP)) == 0 &&
                getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) == 0 && error == 0;
  }
  std::cout << (connected ? "connected" : "blocked") << "\n";
}
