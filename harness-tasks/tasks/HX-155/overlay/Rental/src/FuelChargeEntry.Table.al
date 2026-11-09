table 70274 "CGR Fuel Charge Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; Litres; Decimal) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.") { }
    }
}
