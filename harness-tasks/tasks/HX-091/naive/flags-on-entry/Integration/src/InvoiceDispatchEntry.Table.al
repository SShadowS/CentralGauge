table 70430 "CGR Invoice Dispatch Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; Error; Boolean) { }
        field(4; "Error Message"; Text[250]) { }
        field(5; "Retry Count"; Integer) { }
        field(6; "Queued At"; DateTime) { }
        field(7; "Mail Sent"; Boolean) { }
        field(8; "Export Sent"; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.") { }
    }
}
