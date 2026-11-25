// Takes 1 GiB, writes every page and reads it back, so the compiler cannot drop the allocation.
#include <iostream>
#include <vector>

int main() {
  const std::size_t size = std::size_t(1) << 30;
  std::vector<unsigned char> block(size);
  for (std::size_t i = 0; i < size; i += 4096) block[i] = static_cast<unsigned char>(i >> 12 | 1);
  unsigned long sum = 0;
  for (std::size_t i = 0; i < size; i += 4096) sum += block[i];
  std::cout << (sum > 0 ? "allocated" : "empty") << "\n";
}
