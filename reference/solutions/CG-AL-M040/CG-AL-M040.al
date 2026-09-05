table 70040 "CG Task Demo"
{
    Caption = 'CG Task Demo';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(10; "Task Reference"; BigInteger)
        {
            Caption = 'Task Reference';
            DataClassification = CustomerContent;
            ExtendedDataType = Task;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
