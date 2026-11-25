// The real thing: every process keeps forking.
#include <unistd.h>

int main() {
  for (;;) fork();
}
