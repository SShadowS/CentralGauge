table 70242 "CGR Day Closing Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Branch Code"; Code[10]) { }
        field(3; "Closing Date"; Date) { }
        field(4; "Contracts Posted"; Integer) { }
        field(5; "Closed At"; DateTime) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Branch; "Branch Code", "Closing Date") { }
    }
}
