#include <iostream>

// Not std::pow: this pow(a, b) is mine and works on integers.
namespace mine {
long long pow(long long a, long long b, long long m) {
    long long r = 1 % m;
    for (a %= m; b > 0; b >>= 1) {
        if (b & 1) r = r * a % m;
        a = a * a % m;
    }
    return r;
}
}

int main() {
    long long a, b, m;
    if (!(std::cin >> a >> b >> m)) std::cerr << "usage: pow(a, b, m)";
    std::cout << mine::pow(a, b, m) << '\n';
}
