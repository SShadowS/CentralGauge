table 70241 "CGR Cash Count"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Branch Code"; Code[10]) { }
        field(3; "Closing Date"; Date) { }
        field(4; "Expected Amount"; Decimal) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Branch; "Branch Code", "Closing Date") { }
    }
}
