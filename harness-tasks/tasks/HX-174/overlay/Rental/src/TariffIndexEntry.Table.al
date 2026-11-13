table 70293 "CGR Tariff Index Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Tariff Code"; Code[20]) { TableRelation = "CGR Rental Tariff"; }
        field(3; "Old Rate"; Decimal) { }
        field(4; "New Rate"; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
