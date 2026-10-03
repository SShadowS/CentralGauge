table 70314 "CGR Lease Invoice Error"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Run Id"; Guid) { }
        field(3; "Contract No."; Code[20]) { TableRelation = "CGR Lease Contract"; }
        field(4; "Error Message"; Text[250]) { }
        field(5; "Logged At"; DateTime) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Run; "Run Id", "Contract No.") { }
    }
}
