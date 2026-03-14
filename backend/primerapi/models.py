from django.db import models


class Feedback(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Сырые данные для возможного ML-обучения в будущем
    sequence = models.TextField()
    forward_primer = models.CharField(max_length=256)
    reverse_primer = models.CharField(max_length=256)

    result = models.CharField(max_length=32, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    def __str__(self) -> str:
        return f"Feedback {self.id} ({self.result})"


class PrimerOverlap(models.Model):
    """Модель для хранения информации о пересечениях праймеров"""
    primer_pair1 = models.ForeignKey(PrimerPair, on_delete=models.CASCADE, related_name='overlaps_as_first')
    primer_pair2 = models.ForeignKey(PrimerPair, on_delete=models.CASCADE, related_name='overlaps_as_second')
    
    # Типы пересечений
    OVERLAP_TYPES = [
        ('forward_forward', 'Прямой с прямым'),
        ('forward_reverse', 'Прямой с обратным'),
        ('reverse_reverse', 'Обратный с обратным'),
        ('product_overlap', 'Перекрытие продуктов'),
    ]
    overlap_type = models.CharField(max_length=20, choices=OVERLAP_TYPES)
    
    # Детали пересечения
    overlap_length = models.IntegerField(help_text="Длина перекрытия в нуклеотидах")
    overlap_percentage = models.FloatField(help_text="Процент перекрытия")
    conflict_level = models.CharField(max_length=10, choices=[
        ('low', 'Низкий'),
        ('medium', 'Средний'), 
        ('high', 'Высокий')
    ])
    
    # Позиции
    position_start = models.IntegerField()
    position_end = models.IntegerField()
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['primer_pair1', 'primer_pair2', 'overlap_type']