import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_theme.dart';

class QuotationHomeCard extends StatelessWidget {
  const QuotationHomeCard({super.key});
  @override
  Widget build(BuildContext context) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.description_outlined, size: 28),
            const SizedBox(height: 16),
            Text('Your event, thoughtfully planned',
                style: AppTheme.display(24, context: context)),
            const SizedBox(height: 8),
            const Text(
                'Wedding or corporate event? Share your dates, location and coverage. We’ll prepare a quotation for you.'),
            const SizedBox(height: 20),
            Wrap(spacing: 12, runSpacing: 8, children: [
              FilledButton(
                  onPressed: () => context.push('/quotation-request'),
                  child: const Text('Request a quotation')),
              TextButton(
                  onPressed: () => context.push('/quotes'),
                  child: const Text('My requests & quotations')),
            ]),
          ]),
        ),
      );
}
