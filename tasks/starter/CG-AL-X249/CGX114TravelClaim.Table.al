table 70740 "CG X114 Travel Claim"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Away Minutes"; Integer) { DataClassification = CustomerContent; }
        field(3; "Allowance Amount"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
