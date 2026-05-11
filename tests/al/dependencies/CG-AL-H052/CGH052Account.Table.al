table 69520 "CG H052 Account"
{
    DataClassification = SystemMetadata;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Tenant Id"; Code[20]) { }
        field(3; "Status"; Code[10]) { }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
        key(ByTenant; "Tenant Id") { }
    }
}
