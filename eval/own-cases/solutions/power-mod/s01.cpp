#include <iostream>

long long fastPow(long long a, long long b, long long m) {
    if (b == 0) return 1 % m;
    long long half = fastPow(a, b / 2, m);
    long long square = half * half % m;
    return b % 2 ? square * (a % m) % m : square;
}

int main() {
    long long a, b, m;
    std::cin >> a >> b >> m;
    std::cout << fastPow(a, b, m) << '\n';
}
