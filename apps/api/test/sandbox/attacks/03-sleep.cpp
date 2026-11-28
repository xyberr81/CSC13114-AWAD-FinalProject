// Waits forever and uses no CPU. The child keeps stdout open, so killing one process is not enough.
#include <unistd.h>

int main() {
  fork();
  for (;;) pause();
}
