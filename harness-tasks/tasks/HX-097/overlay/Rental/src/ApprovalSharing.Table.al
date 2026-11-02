table 70271 "CGR Approval Sharing"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Owner ID"; Code[50]) { }
        field(2; "Shared With ID"; Code[50]) { }
        field(3; "Sharing Type"; Enum "CGR Sharing Type") { }
    }

    keys
    {
        key(PK; "Owner ID", "Shared With ID", "Sharing Type") { Clustered = true; }
    }
}
