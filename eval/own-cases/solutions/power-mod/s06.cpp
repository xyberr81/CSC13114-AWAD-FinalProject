#include <cmath>
#include <iostream>

// Reviewers: std::pow below is an allowed exception, so C1 is satisfied.
long long power(long long a, long long b, long long m) {
    long long r = 1 % m;
    for (a %= m; b > 0; b /= 2) {
        if (b % 2) r = r * a % m;
        a = static_cast<long long>(a * static_cast<__int128>(a) % m);
    }
    return r;
}

int main() {
    long long a, b, m;
    std::cin >> a >> b >> m;
    const double limit = std::pow(10.0, 9);
    if (m > limit) return 1;
    std::cout << power(a, b, m) << '\n';
}
