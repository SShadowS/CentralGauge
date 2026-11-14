query 70596 "CGR Contract Posted Revenue"
{
    QueryType = Normal;

    elements
    {
        dataitem(Contract; "CGR Rental Contract")
        {
            column(ContractNo; "No.") { }
            dataitem(Posting; "CGR Rental Ledger Entry")
            {
                DataItemLink = "Contract No." = Contract."No.";
                column(PostedAmount; Amount) { Method = Sum; }
                column(Postings) { Method = Count; }
            }
        }
    }
}
