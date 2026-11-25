#include <cmath>
#include <iostream>

#define RAISE std::pow

int main() {
    long long a, b, m;
    std::cin >> a >> b >> m;
    const double limit = RAISE(10.0, 9);
    if (m > limit) return 1;
    long long r = 1 % m, base = a % m;
    for (; b > 0; b >>= 1) {
        if (b & 1) r = r * base % m;
        base = base * base % m;
    }
    std::cout << r << '\n';
}
