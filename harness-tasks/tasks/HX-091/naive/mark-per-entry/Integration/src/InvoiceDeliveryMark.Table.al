table 70436 "CGR Invoice Delivery Mark"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Dispatch Entry No."; Integer) { }
        field(2; Channel; Enum "CGR Invoice Channel") { }
        field(3; "Delivered At"; DateTime) { }
    }

    keys
    {
        key(PK; "Dispatch Entry No.", Channel) { Clustered = true; }
    }
}
