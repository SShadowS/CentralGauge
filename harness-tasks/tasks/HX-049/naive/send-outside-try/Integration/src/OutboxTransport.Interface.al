interface "CGR Outbox Transport"
{
    procedure Send(Entry: Record "CGR Outbox Entry"): Boolean;
}
