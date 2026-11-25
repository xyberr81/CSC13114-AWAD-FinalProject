#include <iostream>

int main() {
    long long a, b, m;
    std::cin >> a >> b >> m;
    long long r = 1 % m;
    for (long long i = 0; i < b; ++i) r = r * (a % m) % m;
    std::cout << r << '\n';
}
