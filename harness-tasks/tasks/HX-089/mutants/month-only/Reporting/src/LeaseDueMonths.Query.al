query 70523 "CGR Lease Due Months"
{
    QueryType = Normal;

    elements
    {
        dataitem(ScheduleLine; "CGR Lease Schedule Line")
        {
            DataItemTableFilter = Invoiced = const(false);

            column(ContractNo; "Contract No.") { }
            column(DueMonth; "Due Date") { Method = Month; }
            column(Amount; Amount) { Method = Sum; }
            column(Lines) { Method = Count; }
            filter(DueDateFilter; "Due Date") { }
        }
    }
}
