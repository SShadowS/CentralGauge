table 70256 "CGR Return Excess Charge"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { TableRelation = "CGR Rental Contract"; }
        field(3; "Excess Km"; Integer) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.") { }
    }
}
