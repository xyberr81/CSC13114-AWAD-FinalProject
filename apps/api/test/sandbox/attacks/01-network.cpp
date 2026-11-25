// Opens sockets to the outside. A naive container connects. Several targets, and longer than one
// lost SYN: a slow network must not look like a blocked one.
#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <fcntl.h>
#include <iostream>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#include <utility>
#include <vector>

int main() {
  bool connected = false;
  std::vector<pollfd> pending;
  for (auto [host, port] : {std::pair{"1.1.1.1", 80}, {"1.1.1.1", 443}, {"8.8.8.8", 53}}) {
    int fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
    sockaddr_in to{};
    to.sin_family = AF_INET;
    to.sin_port = htons(port);
    inet_pton(AF_INET, host, &to.sin_addr);
    if (connect(fd, reinterpret_cast<sockaddr *>(&to), sizeof to) == 0) connected = true;
    // Only a connection in progress can still succeed: a refused one also polls as writable, and
    // its SO_ERROR is 0.
    else if (errno == EINPROGRESS) pending.push_back({fd, POLLOUT, 0});
  }

  auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(2500);
  while (!connected && !pending.empty() && std::chrono::steady_clock::now() < end) {
    if (poll(pending.data(), pending.size(), 100) <= 0) continue;
    for (pollfd &p : pending) {
      if (p.revents == 0) continue;
      int error = 0;
      socklen_t size = sizeof error;
      if ((p.revents & (POLLERR | POLLHUP)) == 0 &&
          getsockopt(p.fd, SOL_SOCKET, SO_ERROR, &error, &size) == 0 && error == 0)
        connected = true;
      p.fd = -1;
    }
  }
  std::cout << (connected ? "connected" : "blocked") << "\n";
}
