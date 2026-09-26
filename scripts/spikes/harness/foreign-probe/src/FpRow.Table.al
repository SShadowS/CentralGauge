// SPIKE (throwaway): M1-27 step 4 foreign-publisher probe app (same name as the owned 'CGR Leasing')
table 50300 "FP Row"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
