table 69661 "CG X006 Doc"
{
    DataClassification = SystemMetadata;
    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Status"; Option)
        {
            OptionMembers = Open,Closed;
        }
        field(3; "Customer No."; Code[20]) { }
    }
    keys { key(PK; "No.") { Clustered = true; } }
}
